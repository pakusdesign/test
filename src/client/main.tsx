import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import './styles/index.scss';
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

/** Галерея состояний — только в режиме разработки или при явной сборке для проверок. */
const galleryEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_GALLERY === 'true';
const Gallery = galleryEnabled ? lazy(() => import('./gallery/Gallery')) : null;

function Root() {
  if (Gallery && window.location.hash.startsWith('#/gallery')) {
    return (
      <Suspense fallback={<p>Загрузка галереи…</p>}>
        <Gallery />
      </Suspense>
    );
  }
  return <App />;
}

const container = document.getElementById('root');
if (!container) throw new Error('Нет #root');
createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

if (Gallery) {
  window.addEventListener('hashchange', () => {
    // Переход между приложением и галереей — полная перезагрузка, чтобы не смешивать состояние.
    if (window.location.hash.startsWith('#/gallery') !== document.body.hasAttribute('data-gallery')) window.location.reload();
  });
}
