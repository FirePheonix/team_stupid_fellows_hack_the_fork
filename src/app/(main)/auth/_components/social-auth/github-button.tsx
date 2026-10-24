import { cn } from "cn";
import { siGithub } from "simple-icons";

import { SimpleIcon } from "@/components/simple-icon";
import { Button } from "@/components/ui/button";
import { AUTH_AND_BILLING_STALE } from "@/config/app-config";

/** Starts "Sign in with GitHub". A plain link, because the route answers with a redirect to github.com. */
export function GitHubButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  if (AUTH_AND_BILLING_STALE) {
    return (
      <Button variant="secondary" className={cn(className)} disabled>
        <SimpleIcon icon={siGithub} className="size-4" />
        Continue with GitHub
      </Button>
    );
  }

  return (
    <Button variant="secondary" className={cn(className)} asChild {...props}>
      <a href="/api/auth/github/login">
        <SimpleIcon icon={siGithub} className="size-4" />
        Continue with GitHub
      </a>
    </Button>
  );
}
