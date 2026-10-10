import { Link, useParams } from 'react-router-dom';
import { topics } from '../shared/curriculum';
import { usePage } from '../shared/usePage';
export default function Lesson() {
  const { slug } = useParams();
  const topic = topics.find((item) => item.slug === slug);
  usePage('lesson', `${topic?.title ?? 'Lesson not found'} · robo101`);
  if (!topic)
    return (
      <main id="main" className="page-width">
        <h1>Lesson not found</h1>
        <Link to="/roadmap">Back to roadmap</Link>
      </main>
    );
  return (
    <>
      <main id="main" className="lesson-layout page-width">
        <aside className="lesson-sidebar">
          <Link className="back-link" to="/roadmap">
            ← Roadmap
          </Link>
          <h2>Topics</h2>
          <nav id="lesson-nav" aria-label="Lesson topics">
            {topics.map((item) => (
              <Link
                key={item.slug}
                to={`/lessons/${item.slug}`}
                aria-current={item.slug === slug ? 'page' : undefined}
              >
                <span className="lesson-nav-dot" />
                {item.title}
              </Link>
            ))}
          </nav>
        </aside>
        <article className="lesson-page">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <Link to="/roadmap">Roadmap</Link>
            <span>/</span>
            <span id="breadcrumb-title">{topic.title}</span>
          </nav>
          <div className="lesson-heading">
            <span className="eyebrow">LESSON</span>
            <h1 id="lesson-title">{topic.title}</h1>
            <span className="outline-tag">Coming soon</span>
          </div>
          <section className="empty-lesson" aria-label="Empty lesson content">
            <div className="empty-symbol" aria-hidden="true">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path
                  d="M8 4h11l5 5v19H8V4Z M19 4v6h5 M12 16h8 M12 21h5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h2>A space for what's next.</h2>
            <p>Lesson content hasn't been added yet.</p>
          </section>
          <div className="lesson-bottom">
            <Link to="/roadmap">← Back to roadmap</Link>
            <Link to="/lab">Open the simulator ↗</Link>
          </div>
        </article>
      </main>
    </>
  );
}
