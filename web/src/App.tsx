import { Routes, Route, Navigate } from 'react-router-dom';
import { Chrome } from './components/chrome/Chrome';
import { Admin } from './pages/Admin';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { NewWorld } from './pages/NewWorld';
import { WorldFrame } from './pages/WorldFrame';
import { WorldOverview } from './pages/WorldOverview';
import { WorldUsage } from './pages/WorldUsage';
import { Import } from './pages/Import';
import { Console } from './pages/Console';
import { ConsoleRedirect } from './pages/ConsoleRedirect';
import { Backups } from './pages/Backups';

export default function App() {
  return (
    <Routes>
      {/* /login renders standalone — no Chrome shell — so the unauthenticated
          state doesn't try to load /me and /state. */}
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <Chrome>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/worlds/new" element={<NewWorld />} />
              <Route path="/worlds/new/import" element={<Import />} />
              <Route path="/worlds/:name/console" element={<Console />} />
              <Route path="/worlds/:name" element={<WorldFrame />}>
                <Route index element={<WorldOverview />} />
                <Route path="usage" element={<WorldUsage />} />
              </Route>
              <Route path="/console" element={<ConsoleRedirect />} />
              <Route path="/backups" element={<Backups />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Chrome>
        }
      />
    </Routes>
  );
}
