"use client";

// The signed-in profile and its authenticated socket. The session token from
// signup lives in localStorage; there is no wallet.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { rememberAvatar } from "./avatars";
import { api, API_URL, ApiError, type Credentials, type Profile } from "./api";
import { rememberPlayerName } from "./usePlayerNames";

const TOKEN_KEY = "arena.token";

interface Session {
  /** False until the stored token has been checked. */
  ready: boolean;
  profile: Profile | null;
  socket: Socket | null;
  connected: boolean;
  signup(name: string, creds?: Credentials, avatar?: string): Promise<void>;
  /** Sign in to an account made on this or another device. */
  signIn(creds: Credentials): Promise<void>;
  /** Give a guest profile a password (and optionally a new username). */
  claim(creds: { username?: string; password: string }): Promise<void>;
  /** Change your display name and/or @username. */
  rename(changes: { name?: string; username?: string }): Promise<void>;
  /** Change the password; other devices are signed out. */
  changePassword(current: string, next: string): Promise<void>;
  /** Change your profile picture. */
  setAvatar(avatar: string): Promise<void>;
  signOut(): void;
}

const SessionContext = createContext<Session | null>(null);

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // private mode: the session lasts until reload
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const stored = readToken();
    if (!stored) {
      setReady(true);
      return;
    }
    api
      .me(stored)
      .then((p) => {
        setToken(stored);
        rememberAvatar(p.id, p.avatar);
        setProfile(p);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) writeToken(null);
      })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!token) return;
    const s = io(API_URL, { auth: { token }, transports: ["websocket"] });
    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    // A rename or new picture from another tab or device.
    s.on("profile:update", (p: Profile) => {
      rememberAvatar(p.id, p.avatar);
      rememberPlayerName(p.id, p.name);
      setProfile((old) => (old && old.id === p.id ? { ...old, ...p } : old));
    });
    setSocket(s);
    return () => {
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [token]);

  const start = (res: { profile: Profile; token: string }, hasPassword: boolean) => {
    writeToken(res.token);
    setToken(res.token);
    rememberAvatar(res.profile.id, res.profile.avatar);
    setProfile({ ...res.profile, hasPassword });
  };

  const signup = useCallback(async (name: string, creds?: Credentials, avatar?: string) => {
    start(await api.signup(name, creds, avatar), Boolean(creds?.password));
  }, []);

  const signIn = useCallback(async (creds: Credentials) => {
    start(await api.login(creds), true);
  }, []);

  const claim = useCallback(
    async (creds: { username?: string; password: string }) => {
      if (token) setProfile(await api.claim(token, creds));
    },
    [token],
  );

  const rename = useCallback(
    async (changes: { name?: string; username?: string }) => {
      if (!token) return;
      const updated = await api.updateMe(token, changes);
      rememberPlayerName(updated.id, updated.name);
      setProfile(updated);
    },
    [token],
  );

  const changePassword = useCallback(
    async (current: string, next: string) => {
      if (token) setProfile(await api.changePassword(token, current, next));
    },
    [token],
  );

  const setAvatar = useCallback(
    async (avatar: string) => {
      if (!token) return;
      const updated = await api.setAvatar(token, avatar);
      rememberAvatar(updated.id, updated.avatar);
      setProfile((p) => (p ? { ...p, avatar: updated.avatar } : p));
    },
    [token],
  );

  const signOut = useCallback(() => {
    // Revoke this device's token on the server; the profile itself stays.
    if (token) api.logout(token).catch(() => {});
    writeToken(null);
    setToken(null);
    setProfile(null);
  }, [token]);

  return (
    <SessionContext.Provider
      value={{
        ready,
        profile,
        socket,
        connected,
        signup,
        signIn,
        claim,
        rename,
        changePassword,
        setAvatar,
        signOut,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
