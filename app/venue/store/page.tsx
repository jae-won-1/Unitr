"use client";

const products = [
  { name: "Match Ball (Size 5)", price: "£24.99", stock: "In stock", emoji: "⚽" },
  { name: "Training Bibs (set of 10)", price: "£34.99", stock: "In stock", emoji: "🦺" },
  { name: "Venue Water Bottle", price: "£6.99", stock: "Low stock", emoji: "💧" },
  { name: "Goalkeeper Gloves", price: "£19.99", stock: "In stock", emoji: "🧤" },
  { name: "Astro Trainers", price: "£44.99", stock: "Out of stock", emoji: "👟" },
  { name: "Venue Hoodie", price: "£39.99", stock: "In stock", emoji: "🧥" },
];

function stockColor(s: string) {
  if (s === "Out of stock") return "text-red-400";
  if (s === "Low stock") return "text-yellow-400";
  return "text-accent";
}

export default function VenueStorePage() {
  return (
    <div className="px-4 md:px-8 pt-6 pb-10 max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Store</h1>
          <p className="text-xs text-text-secondary mt-0.5">Sell kit, equipment and venue merchandise to your customers.</p>
        </div>
        <button className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-black text-xs font-bold opacity-60 cursor-not-allowed">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Add product
        </button>
      </div>

      <div className="bg-accent/5 border border-accent/20 rounded-xl px-4 py-3">
        <p className="text-xs text-text-secondary"><span className="font-semibold text-accent">Preview.</span> Inventory and checkout are coming soon — the catalogue below shows how the store will look.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {products.map((p) => (
          <div key={p.name} className="bg-surface-2 border border-border rounded-2xl overflow-hidden">
            <div className="aspect-square bg-background flex items-center justify-center text-5xl">{p.emoji}</div>
            <div className="p-3">
              <p className="text-sm font-semibold truncate">{p.name}</p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-sm font-bold text-accent">{p.price}</span>
                <span className={`text-[10px] font-medium ${stockColor(p.stock)}`}>{p.stock}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
