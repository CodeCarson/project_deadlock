import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { bridge } from "../core/bridge";
import {
  parseAccount,
  profileSchema,
  safeImage,
  type Profile,
} from "../core/api";
import { z } from "zod";
export function PlayerSearch({
  input,
  setInput,
  loading,
  onSelect,
  onError,
}: {
  input: string;
  setInput: (value: string) => void;
  loading: boolean;
  onSelect: (id: number) => Promise<void>;
  onError: (value: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false),
    [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1),
    [message, setMessage] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const token = ++generation.current;
    setSuggestions([]);
    setMessage("");
    setSearching(false);
    setActive(-1);
    const query = input.trim();
    try {
      parseAccount(query);
      return;
    } catch {
      /* Names use indexed search. */
    }
    if (query.length < 2 || query.length > 80 || /^https?:\/\//i.test(query))
      return;
    setSearching(true);
    const timer = setTimeout(() => {
      void bridge
        .request({ resource: "search", query })
        .then((result) => {
          if (token !== generation.current) return;
          const profiles = z.array(profileSchema).parse(result.data);
          setSuggestions(profiles);
          setMessage(
            result.warning ??
              (profiles.length
                ? ""
                : "No indexed profiles found. Try another name or use your Steam ID."),
          );
        })
        .catch((error) => {
          if (token === generation.current)
            setMessage(
              error instanceof Error
                ? error.message
                : "Search unavailable. Use a Steam ID.",
            );
        })
        .finally(() => {
          if (token === generation.current) setSearching(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [input]);
  const select = async (id: number) => {
    setOpen(false);
    setSuggestions([]);
    generation.current++;
    try {
      await onSelect(id);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Player lookup failed.");
    }
  };
  return (
    <section className="panel player-lookup">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (open && active >= 0 && suggestions[active]) {
            void select(suggestions[active].account_id);
            return;
          }
          try {
            void select(parseAccount(input));
          } catch {
            setOpen(true);
            onError(
              /^https?:\/\//i.test(input)
                ? "Vanity names are not resolved from links. Use a numeric Steam profile link or search the player's Steam display name."
                : input.trim().length < 2
                  ? "Enter a Steam ID or at least two characters of a Steam name."
                  : "Choose a suggested profile to confirm its Steam account. Names are not unique.",
            );
          }
        }}
      >
        <label htmlFor="player-id">
          <Search size={17} />
          Find your player profile
        </label>
        <div className="lookup-input">
          <input
            id="player-id"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open && suggestions.length > 0}
            aria-controls="player-suggestions"
            aria-activedescendant={
              active >= 0 ? `player-option-${active}` : undefined
            }
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setOpen(true);
              onError("");
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setOpen(false);
                setActive(-1);
              }
              if (
                (e.key === "ArrowDown" || e.key === "ArrowUp") &&
                suggestions.length
              ) {
                e.preventDefault();
                setActive((a) =>
                  a < 0
                    ? e.key === "ArrowDown"
                      ? 0
                      : suggestions.length - 1
                    : (a +
                        (e.key === "ArrowDown" ? 1 : -1) +
                        suggestions.length) %
                      suggestions.length,
                );
                setOpen(true);
              }
            }}
            placeholder="Steam name, account ID or numeric profile link"
            autoComplete="off"
            maxLength={250}
          />
          <button
            className="button primary"
            disabled={loading || !input.trim()}
          >
            <Search size={16} />
            {loading ? "Loading…" : "Load player"}
          </button>
        </div>
        {open && (
          <div className="profile-suggestions">
            {searching && (
              <p role="status">Searching indexed Steam profiles…</p>
            )}
            {message && <p role="status">{message}</p>}
            {suggestions.length > 0 && (
              <ul
                id="player-suggestions"
                role="listbox"
                aria-label="Suggested Steam profiles"
              >
                {suggestions.map((profile, i) => (
                  <li
                    key={profile.account_id}
                    id={`player-option-${i}`}
                    role="option"
                    aria-selected={active === i}
                  >
                    <button
                      type="button"
                      disabled={loading}
                      className={active === i ? "active" : ""}
                      onClick={() => void select(profile.account_id)}
                    >
                      {safeImage(profile.avatarfull) && (
                        <img src={safeImage(profile.avatarfull)} alt="" />
                      )}
                      <span>
                        <strong>{profile.personaname}</strong>
                        <small>Steam account {profile.account_id}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <small>
          Steam names show indexed suggestions after two characters. Confirm the
          account ID when names match. IDs, SteamID64, Steam [U:1:…] and numeric
          profile links still work. No login or API key needed.
        </small>
      </form>
    </section>
  );
}
