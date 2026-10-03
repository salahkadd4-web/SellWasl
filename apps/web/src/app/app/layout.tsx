import { CompanyAuthProvider } from '@/lib/auth';

export default function CompanyLayout({ children }: { children: React.ReactNode }) {
  return <CompanyAuthProvider>{children}</CompanyAuthProvider>;
}
