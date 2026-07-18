import type { ComponentProps } from 'react';
import { RichTextEditor } from './RichTextEditor';

type Props = ComponentProps<typeof RichTextEditor>;

/**
 * Site-wide rich text writing box.
 * Same toolbar, list keyboard behavior, and defaults everywhere (notes, quiz, …).
 */
export function AppRichTextEditor(props: Props) {
  return <RichTextEditor stickyToolbar {...props} />;
}
