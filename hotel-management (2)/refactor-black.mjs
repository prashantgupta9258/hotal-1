import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

// The targeted labels and h3 inside UserView
content = content.replace(/label className="text-xs uppercase tracking-widest text-theme-text\/40 font-bold"/g, 'label className="text-xs uppercase tracking-widest text-theme-text font-bold"');
content = content.replace(/h3 className="text-sm font-bold text-theme-text\/60 uppercase tracking-widest">Your Orders<\/h3>/g, 'h3 className="text-sm font-bold text-theme-text uppercase tracking-widest">Your Orders</h3>');

fs.writeFileSync('src/App.tsx', content);
console.log("Replaced opacities in App.tsx");
