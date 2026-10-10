import { useLayoutEffect } from 'react';
export function usePage(page: string, title: string) {
  useLayoutEffect(() => {
    document.body.dataset.page = page;
    document.title = title;
    document.body.classList.remove('disconnected');
  }, [page, title]);
}
