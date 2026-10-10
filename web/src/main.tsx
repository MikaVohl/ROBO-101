import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { Header } from './shared/Layout';
import './styles/lab.css';
import './styles/site.css';
import './styles/roadmap.css';
import './styles/planning.css';
const Home = lazy(() => import('./pages/Home'));
const Roadmap = lazy(() => import('./pages/Roadmap'));
const Planning = lazy(() => import('./pages/Planning'));
const Lab = lazy(() => import('./pages/Lab'));
const Lesson = lazy(() => import('./pages/Lesson'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <Suspense
        fallback={
          <main id="main" className="page-width" role="status">
            Loading…
          </main>
        }
      >
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/roadmap" element={<Roadmap />} />
          <Route path="/lab" element={<Lab />} />
          <Route path="/lessons/planning" element={<Planning />} />
          <Route path="/lessons/:slug" element={<Lesson />} />
          <Route
            path="*"
            element={
              <main id="main" className="page-width">
                <h1>Page not found</h1>
                <Link to="/">Go home</Link>
              </main>
            }
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
