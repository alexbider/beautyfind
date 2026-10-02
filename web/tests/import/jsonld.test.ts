// Structured data: every template's graph parses, carries the expected types and ids, and never defines
// the same @id twice.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pageLd } from '../../src/components/treatments/format';
import { contentJsonLd } from '../../src/components/content/seo';
import { ORG_ID, WEBSITE_ID, breadcrumbNode, businessId, businessType, duplicateIds, faqNode, graph, itemListNode, ldJson, organizationNode, pageId, webPageNode, webSiteNode } from '../../src/lib/seo/schema';

type Node = Record<string, unknown> & { '@type': string; '@id'?: string };
const parse = (data: unknown) => JSON.parse(ldJson(data)) as { '@context': string; '@graph': Node[] };
const types = (g: { '@graph': Node[] }) => g['@graph'].map(n => n['@type']);
const node = (g: { '@graph': Node[] }, type: string) => g['@graph'].find(n => n['@type'] === type)!;

describe('structured data', () => {
  it('the home graph holds the site, the organization with a logo and contacts, and the page', () => {
    const g = parse(graph([webSiteNode(), organizationNode('תיאור'), webPageNode({ path: '/', name: 'BeautyFind' })]));
    assert.equal(g['@context'], 'https://schema.org');
    assert.deepEqual(types(g), ['WebSite', 'Organization', 'WebPage']);
    const org = node(g, 'Organization') as Node & { logo: { url: string; width: number }; contactPoint: unknown[]; aggregateRating?: unknown; sameAs?: unknown };
    assert.equal(org['@id'], ORG_ID);
    assert.ok(org.logo.url.startsWith('https://beautyfind.co.il/assets/logo.png') && org.logo.width > 0);
    assert.ok(org.contactPoint.length >= 1);
    assert.equal(org.aggregateRating, undefined, 'no rating from our own reviews on the organization');
    const site = node(g, 'WebSite') as Node & { publisher: { '@id': string } };
    assert.equal(site['@id'], WEBSITE_ID);
    assert.equal(site.publisher['@id'], ORG_ID);
    const page = node(g, 'WebPage') as Node & { isPartOf: { '@id': string }; publisher: { '@id': string } };
    assert.equal(page.isPartOf['@id'], WEBSITE_ID);
    assert.equal(page.publisher['@id'], ORG_ID);
    assert.deepEqual(duplicateIds(g['@graph']), []);
  });

  it('a listing page graph has the collection page, a breadcrumb with every level, the item list and the FAQ', () => {
    const path = '/dan/tel-aviv/nails';
    const crumbs = [{ name: 'ראשי', path: '/' }, { name: 'גוש דן', path: '/dan' }, { name: 'תל אביב-יפו', path: '/dan/tel-aviv' }, { name: 'ציפורניים', path }];
    const g = parse(graph([webPageNode({ path, type: 'CollectionPage', name: 'x', breadcrumb: true, mainEntityId: `https://beautyfind.co.il${path}#list` }), breadcrumbNode(path, crumbs), itemListNode(path, 'x', [{ path: '/dan/nails/a', name: 'א' }]), faqNode(path, [{ q: 'ש?', a: 'ת.' }])]));
    assert.deepEqual(types(g), ['CollectionPage', 'BreadcrumbList', 'ItemList', 'FAQPage']);
    const bc = node(g, 'BreadcrumbList') as Node & { itemListElement: Array<{ item: string; position: number }> };
    assert.equal(bc['@id'], `https://beautyfind.co.il${path}#breadcrumb`);
    assert.deepEqual(bc.itemListElement.map(i => i.item), ['https://beautyfind.co.il/', 'https://beautyfind.co.il/dan', 'https://beautyfind.co.il/dan/tel-aviv', `https://beautyfind.co.il${path}`]);
    const list = node(g, 'ItemList') as Node & { itemListElement: Array<{ url: string }> };
    assert.equal(list.itemListElement[0].url, 'https://beautyfind.co.il/dan/nails/a');
    const page = node(g, 'CollectionPage') as Node & { breadcrumb: { '@id': string }; mainEntity: { '@id': string } };
    assert.equal(page.breadcrumb['@id'], bc['@id']);
    assert.equal(page.mainEntity['@id'], list['@id']);
    assert.deepEqual(duplicateIds(g['@graph']), []);
  });

  it('business types follow the primary category and the business id matches the URL', () => {
    assert.equal(businessType('hair-salons'), 'HairSalon');
    assert.equal(businessType('nails'), 'NailSalon');
    for (const c of ['facials', 'brows-lashes', 'makeup', 'permanent-makeup', 'tanning']) assert.equal(businessType(c), 'BeautySalon');
    assert.equal(businessType('spa-massage'), 'DaySpa');
    assert.equal(businessType('dental-aesthetics'), 'Dentist');
    for (const c of ['medical-aesthetics', 'plastic-surgery', 'hair-restoration']) assert.equal(businessType(c), 'MedicalClinic');
    assert.equal(businessType('body-contouring'), 'HealthAndBeautyBusiness');
    assert.equal(businessType(null, true), 'MedicalBusiness');
    assert.equal(businessType(null, false), 'LocalBusiness');
    assert.equal(businessId('/dan/hair-salons/ei-co-salon'), 'https://beautyfind.co.il/dan/hair-salons/ei-co-salon#biz');
    assert.equal(pageId('/dan/hair-salons/ei-co-salon'), 'https://beautyfind.co.il/dan/hair-salons/ei-co-salon#webpage');
  });

  it('the treatment, region and content templates share the same page graph', () => {
    const t = parse(pageLd({ path: '/treatments/nails', type: 'CollectionPage', name: 'ציפורניים', crumbs: [{ name: 'ראשי', path: '/' }, { name: 'תחומי טיפול', path: '/treatments' }, { name: 'ציפורניים', path: '/treatments/nails' }], faqs: [{ q: 'ש?', a: 'ת.' }] }));
    assert.deepEqual(types(t), ['CollectionPage', 'BreadcrumbList', 'FAQPage']);
    assert.deepEqual(duplicateIds(t['@graph']), []);
    const about = parse(contentJsonLd({ href: '/about', metaTitle: 'אודות', description: 'ד' } as never, [{ name: 'ראשי', href: '/' }, { name: 'אודות' }], { organization: true, type: 'AboutPage' }));
    assert.deepEqual(types(about), ['AboutPage', 'BreadcrumbList', 'Organization']);
    const bc = node(about, 'BreadcrumbList') as Node & { itemListElement: Array<{ item: string }> };
    assert.equal(bc.itemListElement[1].item, 'https://beautyfind.co.il/about', 'a crumb without a link points at the page');
    assert.deepEqual(duplicateIds(about['@graph']), []);
    assert.deepEqual(duplicateIds([{ '@id': 'a', x: 1 }, { '@id': 'a', y: 2 }, { '@id': 'a' }]), ['a']);
  });
});
