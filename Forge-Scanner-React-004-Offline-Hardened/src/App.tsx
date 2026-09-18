import { ScannerPage } from './scanner';
import { MOCK_REPS } from './mock-data/reps';

export default function App() {
  return (
    <main className="demo-shell">
      <ScannerPage reps={MOCK_REPS} />
    </main>
  );
}
