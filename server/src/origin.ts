export function isLocalOrigin(origin: string | undefined | null): boolean {
  if (!origin) return true; // Local scripts and headless integration clients.
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
