import { forwardRef, type ComponentProps } from 'react';
import { RichTextEditor, type RichTextEditorHandle } from './RichTextEditor';

type Props = ComponentProps<typeof RichTextEditor>;

/**
 * Site-wide rich text writing box.
 * Same toolbar, list keyboard behavior, and defaults everywhere (notes, quiz, …).
 */
export const AppRichTextEditor = forwardRef<RichTextEditorHandle, Props>(function AppRichTextEditor(props, ref) {
  return <RichTextEditor ref={ref} stickyToolbar {...props} />;
});
