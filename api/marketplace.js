import { corsHeaders, handleOptions } from './_helpers.js';

// NOTE: Vercel serverless functions are stateless. This in-memory store
// resets on each cold start. For production, migrate to a database
// (Vercel KV, Supabase, PlanetScale, etc.)
//
// For now, we dynamically import the seed data as the baseline.

let _listings = null;

async function getListings() {
  if (!_listings) {
    try {
      const { default: seed } = await import('../src/data/marketplaceSeed.js');
      _listings = [...seed];
    } catch {
      _listings = [];
    }
  }
  return _listings;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(res);
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  const listings = await getListings();

  // --- GET: List/search/filter ---
  if (req.method === 'GET') {
    try {
      let results = [...listings];
      const { category, sort, search } = req.query || {};

      if (category) results = results.filter(l => l.category === category);
      if (search) {
        const q = search.toLowerCase();
        results = results.filter(l =>
          l.name.toLowerCase().includes(q) || l.description.toLowerCase().includes(q)
        );
      }

      switch (sort) {
        case 'popular': results.sort((a, b) => b.uses - a.uses); break;
        case 'newest': results.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)); break;
        case 'price-low': results.sort((a, b) => a.pricePerRun - b.pricePerRun); break;
        case 'price-high': results.sort((a, b) => b.pricePerRun - a.pricePerRun); break;
        case 'rating': results.sort((a, b) => b.rating - a.rating); break;
        default: results.sort((a, b) => b.uses - a.uses);
      }

      const sanitized = results.map(({ fullNodes, fullEdges, ...rest }) => rest);
      return res.json(sanitized);
    } catch (err) {
      console.error('Marketplace list error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // --- POST: Publish new listing ---
  if (req.method === 'POST') {
    try {
      const { name, description, category, tags, exampleImages, creatorName, creatorId,
              nodes, edges, fullNodes, fullEdges, pricingType, pricing, visibility,
              marginPercent, margin: marginVal, baseCost } = req.body;

      if (!name || !description || !category || !creatorName || !creatorId) {
        return res.status(400).json({ error: 'name, description, category, creatorName, and creatorId are required' });
      }

      const resolvedPricing = pricingType || pricing || 'free';
      const isFree = resolvedPricing === 'free';
      const resolvedMargin = isFree ? 0 : (marginPercent || marginVal || 0);
      const base = baseCost || 0;
      const pricePerRun = isFree ? 0 : Math.round(base * (1 + resolvedMargin / 100) * 1000) / 1000;

      const listing = {
        id: `mp-${Date.now()}`,
        name, description, category,
        tags: tags || [], exampleImages: exampleImages || [],
        creatorName, creatorId,
        nodes: nodes || [], edges: edges || [],
        ...(visibility === 'closed' && fullNodes ? { fullNodes, fullEdges: fullEdges || [] } : {}),
        visibility: visibility || 'open',
        pricingType: resolvedPricing,
        marginPercent: resolvedMargin,
        baseCost: base, pricePerRun,
        uses: 0, rating: 0, ratingCount: 0,
        publishedAt: new Date().toISOString(),
      };

      listings.push(listing);
      return res.status(201).json(listing);
    } catch (err) {
      console.error('Marketplace publish error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
