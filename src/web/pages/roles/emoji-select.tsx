export const emojis = [
  '1️⃣',
  '2️⃣',
  '3️⃣',
  '4️⃣',
  '5️⃣',
  '6️⃣',
  '7️⃣',
  '8️⃣',
  '9️⃣',
  '🔟',
  '🎉',
  '💻',
  '🎮',
  '🎨',
  '🎵',
  '📚',
  '⚽',
  '🎬',
  '🌍',
  '⭐',
  '🚀',
  '🌟',
  '🍕',
  '☕',
  '🐱',
  '🐶',
  '🏆',
  '🎯',
  '🛠️',
  '📷',
  '💡',
  '🌱',
  '🔥',
  '💜',
  '🧩',
  '🎲',
  '🚲',
  '🏕️',
  '🍀',
  '🦊',
];

export function EmojiSelect({
  name,
  selected,
  label,
  used,
}: Readonly<{
  name: string;
  selected: string;
  label: string;
  used: ReadonlySet<string | null>;
}>) {
  const options = emojis.includes(selected) ? emojis : [selected, ...emojis];

  return (
    <select id={name} name={name} aria-label={label} class="role-emoji">
      {options
        .filter((emoji) => emoji === selected || !used.has(emoji))
        .map((emoji) => (
          <option key={emoji} value={emoji} selected={emoji === selected}>
            {emoji}
          </option>
        ))}
    </select>
  );
}
