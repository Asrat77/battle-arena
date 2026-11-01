// Share a link: the native sheet on phones, the clipboard elsewhere, and a
// select-and-copy fallback when neither is allowed (http on a LAN IP, denied prompt).

export type ShareResult = "shared" | "copied" | "manual" | "cancelled";

export async function shareLink(opts: { title: string; text: string; url: string }): Promise<ShareResult> {
  const mobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile && navigator.share) {
    try {
      await navigator.share(opts);
      return "shared";
    } catch (err) {
      if ((err as Error).name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(opts.url);
    return "copied";
  } catch {
    return "manual";
  }
}
