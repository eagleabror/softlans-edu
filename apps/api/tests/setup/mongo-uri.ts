export function assertIsolatedMongoUri(uri: string): void {
  // Memory-server URIs are a single literal loopback host with an explicit port.
  // Reject SRV, credentials, remote/multiple hosts, and ambiguous URL parsing.
  if (!/^mongodb:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):[1-9]\d{0,4}\/[a-zA-Z0-9_-]*(?:\?replicaSet=[a-zA-Z0-9_-]+)?$/.test(uri)) {
    throw new Error("Testlar faqat lokal, izolyatsiyalangan MongoDB’da ishlashi mumkin");
  }
}
