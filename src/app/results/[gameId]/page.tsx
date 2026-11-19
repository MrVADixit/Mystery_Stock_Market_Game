import { ResultsScreen } from './ResultsScreen';

export const dynamic = 'force-dynamic';

export default async function ResultsPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return <ResultsScreen gameId={gameId} />;
}
