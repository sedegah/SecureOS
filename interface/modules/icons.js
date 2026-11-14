const PATHS = {
  home: ['M3 10.5 12 3l9 7.5V21H3z', 'M9.5 21v-6h5v6'],
  files: ['M3 7h6l2 2h10v11H3z'],
  notes: ['M6 3h9l4 4v14H6z', 'M9 9h6M9 13h6M9 17h4'],
  bookmarks: ['M7 3h10v18l-5-4-5 4z'],
  downloads: ['M12 3v12', 'M8 11l4 4 4-4', 'M4 21h16'],
  passwords: ['M6 11h12v10H6z', 'M9 11V8a3 3 0 0 1 6 0v3'],
  settings: ['M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', 'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M16.5 16.5 21 21'],
  plus: ['M12 5v14M5 12h14'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 14h10l1-14'],
  pencil: ['M4 20h4L20 8l-4-4L4 16z'],
  copy: ['M9 9h11v11H9z', 'M5 15V4h11'],
  move: ['M4 12h15', 'M15 8l4 4-4 4'],
  open: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'],
  refresh: ['M20 12a8 8 0 1 1-2.6-5.9', 'M20 4v5h-5'],
  up: ['M12 20V5', 'M6 11l6-6 6 6'],
  left: ['M15 5l-7 7 7 7'],
  right: ['M9 5l7 7-7 7'],
  eye: ['M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  eyeOff: ['M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z', 'M4 4l16 16'],
  check: ['M4 12l5 5L20 6'],
  close: ['M6 6l12 12M18 6L6 18'],
  drive: ['M4 14h16v6H4z', 'M8 14V6h8v8', 'M7 17h2'],
  file: ['M7 3h7l4 4v14H7z'],
  clock: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'M12 8v4l3 2'],
  warning: ['M12 4l9 16H3z', 'M12 10v4M12 17h.01'],
  lockOpen: ['M6 11h12v10H6z', 'M9 11V8a3 3 0 0 1 5.7-1.3'],
  star: ['M12 4l2.4 5 5.6.8-4 4 1 5.6-5-2.8-5 2.8 1-5.6-4-4 5.6-.8z'],
};

export function icon(name, size = 18) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of PATHS[name] ?? PATHS.file) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}