const KEY = "klikgo.device";

/**
 * A random id this browser keeps (localStorage) and sends as X-Device-Id, so the server can stop
 * one phone claiming a promo or referral twice with different accounts. It identifies nothing
 * else and the server stores only its hash. Null when storage is blocked (private mode).
 */
export function deviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    let id = window.localStorage.getItem(KEY);
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      id = window.crypto.randomUUID().replace(/-/g, "");
      window.localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}
