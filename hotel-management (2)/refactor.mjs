import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

// Replace standard colors to use themes
content = content.replace(/bg-\[#050505\]/g, 'bg-theme-bg');
content = content.replace(/bg-\[#121212\]/g, 'bg-theme-bg');
content = content.replace(/bg-white\/5/g, 'bg-glass');
content = content.replace(/bg-white\/10/g, 'bg-glass-hover');
content = content.replace(/border-white\/10/g, 'border-glass');
content = content.replace(/border-white\/5/g, 'border-glass-subtle');

// Texts
content = content.replace(/text-white\/90/g, 'text-theme-text/90');
content = content.replace(/text-white\/60/g, 'text-theme-text/60');
content = content.replace(/text-white\/40/g, 'text-theme-text/40');
content = content.replace(/text-white\/30/g, 'text-theme-text/30');
content = content.replace(/text-white\/10/g, 'text-theme-text/10');

content = content.replace(/(?<!-)text-white(?![\/\-])/g, 'text-theme-text');

// Re-fix primary buttons that need white text in light mode 
content = content.replace(/bg-neon-([a-z]+) text-theme-text/g, 'bg-neon-$1 text-white');
content = content.replace(/bg-green-500 text-theme-text/g, 'bg-green-500 text-white');
content = content.replace(/bg-red-500 text-theme-text/g, 'bg-red-500 text-white');
content = content.replace(/bg-blue-500 text-theme-text/g, 'bg-blue-500 text-white');

fs.writeFileSync('src/App.tsx', content);
console.log("Refactoring complete");
