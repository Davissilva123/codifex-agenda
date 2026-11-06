export function extractMeetingUrl(locationOrText: string): string | null {
  if (!locationOrText) return null;
  const candidates = locationOrText.match(/https?:\/\/[^\s<>]+/gi) || [];
  return candidates
    .map((candidate) => candidate.replace(/[.,;:!?)}\]]+$/, ""))
    .find(isMeetingLink) || null;
}

export function isMeetingLink(urlOrText: string): boolean {
  if (!urlOrText) return false;
  const meetingDomains = [
    "meet.google.com",
    "teams.microsoft.com",
    "teams.live.com",
    "zoom.us",
    "webex.com",
    "whereby.com",
    "discord.gg",
    "discord.com",
    "skype.com",
    "meet.jit.si",
  ];

  try {
    const url = new URL(urlOrText);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return meetingDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}
