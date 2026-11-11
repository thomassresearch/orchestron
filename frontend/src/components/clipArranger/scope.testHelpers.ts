import { fireEvent, screen, within } from '@testing-library/react';

/** Exercise the real upfront controls; callers can also explicitly change an existing draft's scope. */
export function chooseStructureScope(scope: string = 'local') {
  const dialog = screen.queryByRole('dialog', { name: 'Choose editing scope' });
  const node = dialog ?? document.querySelector<HTMLElement>('[data-edit-scope="structure"], [data-edit-scope="group"], [data-edit-scope="supergroup"]');
  if (!node) return;
  const view = within(node);
  const change = view.queryByRole('button', { name: 'Change scope' });
  if (change && change.getAttribute('aria-expanded') !== 'true') fireEvent.click(change);
  const choice = view.queryByRole('button', { name: scope === 'all' ? /^(All linked definitions|Edit linked (supergroup|group))/ : /^(Only this occurrence|Create variation here)$/ });
  if (choice && !choice.hasAttribute('disabled')) fireEvent.click(choice);
}

export function structureSaveButton() {
  return screen.getAllByRole('button', { name: /^Save structure ·/ })[0];
}
