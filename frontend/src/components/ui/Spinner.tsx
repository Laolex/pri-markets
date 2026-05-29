export function Spinner({ size = 16, color = "gold" }: { size?: number; color?: "gold" | "teal" | "white" }) {
  const stroke = color === "teal" ? "#2EC4B6" : color === "white" ? "#DDD5C4" : "#C4993B";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin flex-shrink-0">
      <circle cx="12" cy="12" r="10" stroke={stroke} strokeWidth="2" strokeOpacity="0.12" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
