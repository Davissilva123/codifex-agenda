import { cn } from "@/lib/utils";

type Props = React.HTMLAttributes<HTMLDivElement>;

export const Card = ({ className, children, ...props }: Props) => (
  <div
    className={cn(
      "rounded-xl border border-line bg-surface p-4 shadow-sm transition-shadow hover:shadow-md",
      className
    )}
    {...props}
  >
    {children}
  </div>
);
