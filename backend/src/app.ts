import dotenv from "dotenv";
// .env.local (never committed) wins over .env, as in Next.js.
dotenv.config({ path: [".env.local", ".env"] });
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { getGame, listGames } from "../../engine/registry";
import type { MatchRecord } from "../../engine/types";
import type { Clock } from "./clock";
import { Chat } from "./chat";
import { Identity, identityRoutes, type Profile } from "./identity";
import { Ledger, ledgerRoutes, type LedgerOptions } from "./ledger";
import { Lobby, lobbyRoutes, type LobbyOptions } from "./lobby";
import { MatchRuntime, profileRoom, type Match } from "./matches";
import { moderatorList } from "./moderators";
import { matchRoutes, Recorder, type StoredMatch } from "./recorder";
import { rewardRoutes, Rewards } from "./rewards";
import { Social, socialRoutes } from "./social";
import { guardSocket } from "./safe";
import { FileStore, type Store } from "./store";
import { tournamentRoutes, Tournaments } from "./tournaments";
import { depositAccountsFromEnv, Deposits, httpVerifyEt, type DepositOptions } from "./deposits";
import { httpTelegram, secondApprovalFromEnv, withdrawalLimitsFromEnv, Withdrawals, type WithdrawalOptions } from "./withdrawals";
import { depositHoldFromEnv, Wallet, walletAdminRoutes, walletModeFromEnv, walletRoutes, type WalletOptions } from "./wallet";
import { FileTxnLog, MemoryTxnLog } from "./walletLog";

export interface AppOptions {
  store?: Store;
  ledger?: LedgerOptions;
  clock?: Clock;
  games?: LobbyOptions["games"];
  wallet?: Omit<WalletOptions, "onChange">;
  deposits?: Partial<Omit<DepositOptions, "onUpdate">>;
  withdrawals?: Partial<Omit<WithdrawalOptions, "onUpdate">>;
}

export function createApp(options: AppOptions = {}) {
  const origin = process.env.FRONTEND_URL || "http://localhost:3000";
  const dataFile = process.env.DATA_FILE || "data/db.json";
  const store = options.store ?? new FileStore(dataFile);
  // Bound once the socket server exists: a rename or new picture reaches the owner's open tabs.
  let onProfileChange: (profile: Profile) => void = () => {};
  const identity = new Identity(store, Date.now, { onChange: (p) => onProfileChange(p) });
  const ledger = new Ledger(store, options.ledger);

  const app = express();
  // Behind Render's proxy every request would share one IP (and one rate limit). Set
  // TRUST_PROXY=1 there so req.ip is the real client; leave it unset when exposed directly.
  const hops = Number(process.env.TRUST_PROXY);
  if (hops > 0) app.set("trust proxy", hops);
  app.use(cors({ origin, credentials: true }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use(identityRoutes(identity));
  app.use(ledgerRoutes(ledger));

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin, methods: ["GET", "POST"], credentials: true },
    // A phone that locks or loses signal leaves no close frame. Ping often so a
    // dead socket leaves the queue in ~15 s instead of ~45 s and isn't paired.
    pingInterval: 10_000,
    pingTimeout: 5_000,
  });

  // Sockets authenticate with the session token from signup: io(url, { auth: { token } }).
  io.use((socket, next) => {
    const profile = identity.byToken(socket.handshake.auth?.token);
    if (!profile) return next(new Error("unauthorized"));
    socket.data.profileId = profile.id;
    next();
  });

  onProfileChange = (profile) => io.to(profileRoom(profile.id)).emit("profile:update", profile);

  const matches = new MatchRuntime(io, { clock: options.clock, store });
  // Money first: the wallet's "end" listener is attached before any other, so the
  // stake is settled before recording, rewards or tournaments run.
  const wallet = new Wallet(store, {
    mode: walletModeFromEnv(),
    depositHoldMs: depositHoldFromEnv(),
    // Every balance change, hash-chained, beside db.json (tests keep it in memory).
    log: options.store ? new MemoryTxnLog() : new FileTxnLog(process.env.WALLET_LOG_FILE || join(dirname(dataFile), "wallet-log.jsonl")),
    ...options.wallet,
    onChange: (id, balance) => io.to(profileRoom(id)).emit("wallet:balance", { balance }),
  });
  matches.on("end", (m: Match, record: MatchRecord | null) => {
    const escrow = wallet.escrowForMatch(m.id);
    if (escrow && record) wallet.settle(escrow.id, record.outcome);
  });
  const recorder = new Recorder(store, ledger, matches);
  app.use(matchRoutes(recorder, matches));
  app.use(walletRoutes(wallet, identity));
  app.use(walletAdminRoutes(wallet));
  const verifyKey = process.env.VERIFY_ET_KEY;
  const verifyEt = verifyKey ? httpVerifyEt(verifyKey, process.env.VERIFY_ET_URL || undefined) : null;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegram = botToken ? httpTelegram(botToken, process.env.TELEGRAM_API_URL || undefined) : null;
  const moderatorChat = process.env.TELEGRAM_MODERATOR_CHAT || null;
  const moderators = moderatorList(process.env.TELEGRAM_MODERATORS, moderatorChat);
  if (telegram && moderatorChat && moderators.count === 0) console.warn("TELEGRAM_MODERATORS is empty: nobody can act on withdrawals or deposit reviews");
  const nameOf = (id: string) => {
    const p = identity.get(id);
    return p ? `${p.name} (@${p.username})` : id;
  };
  const deposits = new Deposits(store, wallet, {
    verifyEt,
    accounts: depositAccountsFromEnv(),
    receiverName: process.env.DEPOSIT_RECEIVER_NAME?.trim() || null,
    accountCreatedAt: (id) => identity.get(id)?.createdAt ?? null,
    moderators: telegram && moderatorChat ? { call: (m, p) => telegram.call(m, p), chatId: moderatorChat, allowed: moderators } : null,
    nameOf,
    // Behind TRUST_PROXY hops, the client is that many entries from the end of X-Forwarded-For.
    ipOf: (socket) => {
      const fwd = String(socket.handshake.headers["x-forwarded-for"] ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      return hops > 0 && fwd.length >= hops ? fwd[fwd.length - hops] : socket.handshake.address;
    },
    ...options.deposits,
    onUpdate: (deposit) => io.to(profileRoom(deposit.profileId)).emit("wallet:deposit", deposit),
  });
  // A deposit check that was running when the last process died: finish or release it.
  deposits.recover();
  wallet.depositAccounts = () => deposits.accounts();
  wallet.depositPayer = (id) => deposits.payer(id);
  const withdrawals = new Withdrawals(store, wallet, {
    telegram,
    moderatorChat,
    verifyEt,
    nameOf,
    payoutSenderName: process.env.PAYOUT_SENDER_NAME?.trim() || null,
    moderators,
    limits: withdrawalLimitsFromEnv(),
    secondApprovalAbove: secondApprovalFromEnv(process.env.SECOND_APPROVAL_ABOVE_BIRR),
    alsoHandle: (update) => deposits.handleUpdate(update),
    ...options.withdrawals,
    onUpdate: (w) => io.to(profileRoom(w.profileId)).emit("wallet:withdrawal", withdrawals.view(w)),
  });
  // A withdrawal the last process saved but never debited, or closed but never refunded.
  withdrawals.recover();
  wallet.withdrawals = (id) => withdrawals.summary(id);
  const lobby = new Lobby(io, matches, identity, { clock: options.clock, games: options.games, wallet });
  app.use(lobbyRoutes(lobby));
  const rewards = new Rewards(store, ledger, {
    isPlayer: (id) => identity.get(id) !== null,
    nameOf: (id) => identity.get(id)?.name ?? id,
    notify: (id, payload) => io.to(profileRoom(id)).emit("notify", payload),
  });
  recorder.on("recorded", (stored: StoredMatch) => rewards.matchRecorded(stored));
  app.use(rewardRoutes(rewards, (id) => identity.get(id) !== null));
  // Watching a match to the end counts towards the Watcher badge.
  matches.on("spectated", (m: Match, ids: string[]) => ids.forEach((id) => rewards.spectated(id, m.id, m.endedAt ?? Date.now())));
  const chat = new Chat(io, matches, lobby, identity, { clock: options.clock });
  const social = new Social(io, store, identity, matches, lobby, recorder);
  app.use(socialRoutes(social, identity));
  const tournaments = new Tournaments(store, io, matches, identity, {
    clock: options.clock,
    games: options.games,
    onChampion: (id, tournamentId, ts) => rewards.tournamentWon(id, tournamentId, ts),
  });
  app.use(tournamentRoutes(tournaments));

  // Every "end" listener is attached now, so resumed matches settle like any other.
  // Staked matches are saved after each move and pick up where they were; a stake
  // still held for any other match belongs to one that died with the old process.
  const resumed = matches.restore(options.games ?? { get: getGame, list: listGames });
  wallet.refundAllHeld(new Set(resumed));

  io.on("connection", (socket) => {
    // One bad message must never crash the process: a crash refunds every live stake.
    guardSocket(socket);
    matches.attach(socket, socket.data.profileId as string);
    lobby.attach(socket, socket.data.profileId as string);
    chat.attach(socket, socket.data.profileId as string);
    social.attach(socket, socket.data.profileId as string);
    tournaments.attach(socket, socket.data.profileId as string);
    wallet.attach(socket, socket.data.profileId as string);
    deposits.attach(socket, socket.data.profileId as string);
    withdrawals.attach(socket, socket.data.profileId as string);
  });

  return { app, httpServer, io, store, identity, ledger, matches, recorder, lobby, rewards, chat, social, tournaments, wallet, deposits, withdrawals };
}
