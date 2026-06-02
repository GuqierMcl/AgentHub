import { SunIcon } from "@/components/ui/sun";
import { MoonIcon } from "@/components/ui/moon";
import { SunMoonIcon } from "@/components/ui/sun-moon";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/useTheme";

const THEME_ORDER = ["light", "dark", "system"] as const;

const THEME_ICONS = {
  light: SunIcon,
  dark: MoonIcon,
  system: SunMoonIcon,
} as const;

const THEME_LABELS = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
} as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const Icon = THEME_ICONS[theme];

  const cycleTheme = () => {
    const currentIndex = THEME_ORDER.indexOf(theme);
    const nextIndex = (currentIndex + 1) % THEME_ORDER.length;
    setTheme(THEME_ORDER[nextIndex]);
  };

  return (
    <Button
      aria-label={`切换主题：${THEME_LABELS[theme]}`}
      onClick={cycleTheme}
      variant="ghost"
      size="icon-sm"
      type="button"
    >
      <Icon className="![&_svg]:size-4" size={16} />
    </Button>
  );
}
