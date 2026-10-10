export function shortAnnouncement(message: string) {
  return message
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/Small jungle camp/g, "Small camp")
    .replace(/Medium jungle camp/g, "Medium camp")
    .replace(/Large jungle camp/g, "Large camp")
    .replace(/Boxes & golden statues/g, "Boxes and statues")
    .replace(/window begins now/g, "window open")
    .replace(/window begins in/g, "window in")
    .replace(/earliest respawn now/g, "can respawn")
    .replace(/event now|respawn now/g, "ready")
    .slice(0, 180);
}
