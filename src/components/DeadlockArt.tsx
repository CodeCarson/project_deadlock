/** Unmodified Valve artwork; pinned sources and attribution ship with the app. */
export function DeadlockArt({
  name,
  alt = "",
  className = "",
}: {
  name: string;
  alt?: string;
  className?: string;
}) {
  return (
    <img
      className={`deadlock-art ${className}`}
      src={new URL(`deadlock/${name}`, document.baseURI).href}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      draggable={false}
      onError={(event) => {
        event.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}

export const eventArtwork: Record<string, string> = {
  "small-camp": "camp-small.png",
  "medium-camp": "camp-medium.png",
  "large-camp": "camp-large.png",
  breakables: "idol.webp",
  boxes: "idol.webp",
  statues: "idol.webp",
  urn: "urn.png",
  bridge: "buff.png",
  rift: "spirit.svg",
};

export function heroArtwork(name: string) {
  return `hero-${name.toLowerCase().replaceAll(" & ", " and ").replaceAll(" ", "-")}.png`;
}
