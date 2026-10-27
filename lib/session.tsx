"use client";

// The signed-in profile and its authenticated socket. The session token from
// signup lives in localStorage; there is no wallet.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api, API_URL, ApiError, type Profile } from "./api";

const TOKEN_KEY = "arena.token";

interface Session {
  /** False until the stored token has been checked. */
  ready: boolean;
  profile: Profile | null;
  socket: Socket | null;
  connected: boolean;
  signup(name: string): Promise<void>;
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

  const signup = useCallback(async (name: string) => {
    const res = await api.signup(name);
    writeToken(res.token);
    setToken(res.token);
    setProfile(res.profile);
  }, []);

  const signOut = useCallback(() => {
    writeToken(null);
    setToken(null);
    setProfile(null);
  }, []);

  return (
    <SessionContext.Provider value={{ ready, profile, socket, connected, signup, signOut }}>{children}</SessionContext.Provider>
  );
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
