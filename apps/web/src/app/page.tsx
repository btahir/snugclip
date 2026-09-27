import type { Metadata } from 'next';
import { Footer } from '@/components/site/Footer';
import { Header } from '@/components/site/Header';
import { Tool } from '@/components/tool/Tool';
import { t } from '@/i18n/en';

export const metadata: Metadata = {
  title: { absolute: t.meta.homeTitle },
  description: t.meta.homeDescription,
  alternates: { canonical: '/' },
};

export default function Home() {
  return (
    <>
      <Header />
      <main className="wrap" style={{ paddingTop: 4, paddingBottom: 24 }}>
        <Tool hero />
      </main>
      <Footer />
    </>
  );
}
