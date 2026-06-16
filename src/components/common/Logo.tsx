export function Logo({ size = 32 }: { size?: number; rounded?: number }) {
  return <img src="/logo.png" width={size} height={size} alt="Taha Note" className="select-none" draggable={false} />;
}
