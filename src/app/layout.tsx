import type { Metadata, Viewport } from 'next';
import { AppProvider } from '@/lib/store';
import './globals.css';

export const metadata: Metadata = {
  title: 'AdmitPath AI — Build your university application route',
  description:
    'From "Where can I apply?" to "What should I do next?" — a personalized university admissions navigator that turns your academic profile, budget and preferences into explained recommendations, a comparison, a roadmap and a next action.',
  applicationName: 'AdmitPath AI',
  keywords: ['university admissions', 'scholarships', 'application roadmap', 'study abroad'],
  openGraph: {
    title: 'AdmitPath AI',
    description: 'From "Where can I apply?" to "What should I do next?"',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#fafaf8',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Loaded at runtime rather than at build time so the app builds and runs
            in fully offline environments, falling back to the system stack.

            The no-page-custom-font rule targets the Pages Router, where a font in
            a page rather than _document really would load for one route only.
            This is the App Router root layout, so it already applies to every
            route and the warning does not hold. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
