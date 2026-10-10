import { Link, useLocation } from 'react-router-dom';

export function Header() {
  const path = useLocation().pathname;
  const active = path === '/' ? 'home' : path === '/lab' ? 'lab' : 'roadmap';

  return (
    <header className="site-header" data-site-header>
      <Link className="site-brand" to="/">
        <img src="/favicon.svg" alt="robo101 logo" className="site-brand-mark" />
        <span>
          robo<span className="brand-light">101</span>
        </span>
      </Link>
      <nav aria-label="Main navigation">
        <Link to="/" aria-current={active === 'home' ? 'page' : undefined}>
          Home
        </Link>
        <Link to="/roadmap" aria-current={active === 'roadmap' ? 'page' : undefined}>
          Roadmap
        </Link>
        <Link to="/lab" aria-current={active === 'lab' ? 'page' : undefined}>
          Simulator
        </Link>
      </nav>
      <Link className="nav-action" to="/lessons/simulation-anatomy">
        Start here <span aria-hidden="true">↗</span>
      </Link>
    </header>
  );
}
