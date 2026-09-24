export const cursorStyles = ['classic', 'arrow', 'crosshair', 'ring'];
export const normalizeCursor = style => cursorStyles.includes(style) ? style : 'classic';
export const cursorColors = {'':'Automatic', '#168a80':'Teal', '#2878d0':'Blue', '#8755ce':'Purple', '#ce4585':'Pink', '#d34a43':'Red', '#c57516':'Amber', '#398747':'Green'};
export const normalizeCursorColor = color => Object.hasOwn(cursorColors, color) ? color : '';
