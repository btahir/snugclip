import Link from 'next/link';
import { Footer } from '@/components/site/Footer';
import { Header } from '@/components/site/Header';
import { EmptyGlass } from '@/components/tool/FitGlass';

export default function NotFound() {
  return (
    <>
      <Header />
      <main className="wrap" style={{ textAlign: 'center', padding: '64px 16px' }}>
        <EmptyGlass question size={80} />
        <h1 className="h1" style={{ fontSize: 40 }}>
          This page doesn&apos;t exist.
        </h1>
        <p className="lede" style={{ margin: '12px auto 24px' }}>
          The tool is one click away.
        </p>
        <Link className="btn primary lg" href="/">
          Open Snugclip
        </Link>
      </main>
      <Footer />
    </>
  );
}
