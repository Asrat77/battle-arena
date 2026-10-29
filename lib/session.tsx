"use client";

// The signed-in profile and its authenticated socket. The session token from
// signup lives in localStorage; there is no wallet.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api, API_URL, ApiError, type Credentials, type Profile } from "./api";

const TOKEN_KEY = "arena.token";

interface Session {
  /** False until the stored token has been checked. */
  ready: boolean;
  profile: Profile | null;
  socket: Socket | null;
  connected: boolean;
  signup(name: string, creds?: Credentials): Promise<void>;
  /** Sign in to an account made on this or another device. */
  signIn(creds: Credentials): Promise<void>;
  /** Give a guest profile a username and password. */
  claim(creds: Credentials): Promise<void>;
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
    setSocket(s);
    return () => {
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [token]);

  const start = (res: { profile: Profile; token: string }, username: string | null) => {
    writeToken(res.token);
    setToken(res.token);
    setProfile({ ...res.profile, username });
  };

  const signup = useCallback(async (name: string, creds?: Credentials) => {
    start(await api.signup(name, creds), creds?.username.trim().toLowerCase() ?? null);
  }, []);

  const signIn = useCallback(async (creds: Credentials) => {
    start(await api.login(creds), creds.username.trim().toLowerCase());
  }, []);

  const claim = useCallback(
    async (creds: Credentials) => {
      if (token) setProfile(await api.claim(token, creds));
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
