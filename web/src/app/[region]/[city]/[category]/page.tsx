import type { Metadata } from 'next';
import { DirectoryPage, directoryMetadata } from '@/components/directory/DirectoryPage';

// Directory, one category within a city (design pageType=treatment), e.g. /dan/tel-aviv/hair-removal.

type Props = {
  params: Promise<{ region: string; city: string; category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  return directoryMetadata(params, searchParams);
}

export default function CategoryDirectoryPage({ params, searchParams }: Props) {
  return <DirectoryPage params={params} searchParams={searchParams} />;
}
