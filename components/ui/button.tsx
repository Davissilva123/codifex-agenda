import { cn } from "@/lib/utils";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
};

export const Button = ({ variant = "primary", className, children, ...props }: Props) => {
  const base = "inline-flex items-center justify-center rounded-md px-4 py-2 font-medium transition-colors";
  const variants = {
    primary: "bg-accent text-white hover:brightness-95",
    ghost: "bg-transparent text-accent hover:bg-accent/10",
  };

  return (
    <button className={cn(base, variants[variant], className)} {...props}>
      {children}
    </button>
  );
};
