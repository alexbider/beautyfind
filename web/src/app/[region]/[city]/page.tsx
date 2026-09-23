import type { Metadata } from 'next';
import { DirectoryPage, directoryMetadata } from '@/components/directory/DirectoryPage';

// Directory, city listing (design pageType=city). Filters, sort and ?show= are read from the URL
// and applied server-side; see components/directory.

type Props = {
  params: Promise<{ region: string; city: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  return directoryMetadata(params, searchParams);
}

export default function CityDirectoryPage({ params, searchParams }: Props) {
  return <DirectoryPage params={params} searchParams={searchParams} />;
}
