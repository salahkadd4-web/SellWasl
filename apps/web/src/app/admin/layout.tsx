import { PlatformAuthProvider } from '@/lib/auth';

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <PlatformAuthProvider>{children}</PlatformAuthProvider>;
}
