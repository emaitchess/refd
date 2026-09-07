import type { GlossaryDefinition } from './glossary';

/**
 * Category vocabulary, not refd's own. These terms describe the surfaces and
 * practices the industry argues about, so they are deliberately kept out of
 * GLOSSARY_TERMS: the dashboard Help glossary renders that list, and a
 * logged-in user looking up "workspace" is not asking what GEO stands for.
 * Nothing here is read by the product, so pages built from these must not
 * claim to be generated from the software the way metric pages are.
 */
export type ConceptCategory =
  | 'Answer surfaces'
  | 'How AI answers work'
  | 'Optimization practice';

export type ConceptDefinition = GlossaryDefinition<ConceptCategory>;

export const CONCEPT_CATEGORIES: ConceptCategory[] = [
  'Answer surfaces',
  'How AI answers work',
  'Optimization practice',
];

export const CONCEPT_TERMS: ConceptDefinition[] = [
  {
    id: 'answer-engine',
    title: 'Answer engine',
    category: 'Answer surfaces',
    definition:
      'A search product that returns a written answer instead of a list of links.',
    details:
      'ChatGPT, Perplexity, Gemini, Google AI Mode, and Google AI Overviews all compose prose and attach a set of sources. The distinction that matters for measurement is that the answer text and the source list are separate signals: a brand can be named in the prose without being cited, and cited without being named. Ranking has no single position to report, because the answer is one block rather than ten results.',
  },
  {
    id: 'google-ai-overview',
    title: 'Google AI Overview',
    category: 'Answer surfaces',
    definition:
      'The AI-generated summary Google places above the classic result list for some queries.',
    details:
      'Overviews appear on a minority of queries, and Google does not publish which. Their absence is a real observation about the query rather than a collection failure, which is why refd records it as a valid result. Google Search Console reports clicks from a page carrying an Overview but does not separate Overview citations from ordinary organic clicks, so Search Console cannot tell you whether you were cited.',
  },
  {
    id: 'google-ai-mode',
    title: 'Google AI Mode',
    category: 'Answer surfaces',
    definition:
      "Google's dedicated conversational search surface, separate from AI Overviews.",
    details:
      'AI Mode is entered deliberately and answers follow-up questions in context, while an Overview is served into a normal results page. They draw on different retrieval behavior and frequently cite different sources for the same question, so a brand strong in one can be absent from the other. Measuring them as one number hides that split.',
  },
  {
    id: 'zero-click-search',
    title: 'Zero-click search',
    category: 'Answer surfaces',
    definition:
      'A search that ends without the user visiting any result, because the answer was given on the results page.',
    details:
      'Answer engines make this the default rather than the exception. The consequence for measurement is that analytics tools which count sessions cannot see the interaction at all: the brand was read, compared, and possibly recommended, with no referral to record. Visibility inside the answer becomes the only observable signal.',
  },
  {
    id: 'retrieval-augmented-generation',
    title: 'Retrieval-augmented generation',
    category: 'How AI answers work',
    definition:
      'Fetching documents at question time and giving them to a language model to write its answer from.',
    details:
      'Usually shortened to RAG. It explains why AI answers change without any model being retrained: the retrieval step ran again and returned a different set of pages. It also explains why being cited is partly a retrieval problem rather than a writing problem, and why the same brand can appear in one engine and not another that retrieved from a different index.',
  },
  {
    id: 'grounding',
    title: 'Grounding',
    category: 'How AI answers work',
    definition:
      'Tying an answer to retrieved sources so its claims can be traced rather than invented.',
    details:
      'A grounded answer carries citations the reader can open. Grounding is not a guarantee of accuracy: a source can be cited and still be misread, and some engines attach sources after composing the text, so a citation is evidence the document was retrieved rather than proof it was used. This is why a mention and a citation have to be counted separately.',
  },
  {
    id: 'answer-variance',
    title: 'Answer variance',
    category: 'How AI answers work',
    definition:
      'The tendency of an answer engine to give different answers to the same question.',
    details:
      'Sampling, retrieval, and personalization all move between runs, so a single answer is one draw from a distribution rather than a reading of a fixed rank. A brand present in one answer and absent from the next has not necessarily changed. The practical consequence is that any AI visibility number built on one observation per question is not measuring the brand, and that comparisons need repeated runs over a fixed prompt set.',
  },
  {
    id: 'hallucination',
    title: 'Hallucination',
    category: 'How AI answers work',
    definition: 'A confident claim in an AI answer that no source supports.',
    details:
      'For brand monitoring the important cases are invented products, wrong pricing, and attributed quotes that were never said. These are visible only by reading the answer text, which is why storing the raw answer behind every score matters: an aggregate that says "mentioned" cannot distinguish an accurate recommendation from a fabricated one.',
  },
  {
    id: 'answer-engine-optimization',
    title: 'Answer engine optimization',
    category: 'Optimization practice',
    definition:
      'The practice of trying to influence whether and how a brand appears in AI-generated answers.',
    details:
      "Commonly abbreviated AEO. The tactics claimed for it overlap heavily with established SEO work: clear structure, direct answers near the top, primary sources, and content an engine can extract a clean claim from. The honest caveat is that no engine publishes its selection criteria, so causal claims in this field are inference rather than fact. refd measures whether appearance changed; it does not perform optimization, and treats any tactic's effect as a hypothesis to be tested against repeated runs.",
  },
  {
    id: 'generative-engine-optimization',
    title: 'Generative engine optimization',
    category: 'Optimization practice',
    definition:
      'A near-synonym for answer engine optimization, usually abbreviated GEO.',
    details:
      'The two labels are used interchangeably by most practitioners. Where people do draw a line, GEO is framed around generative assistants such as ChatGPT and Gemini, and AEO around answer features inside traditional search such as AI Overviews and featured snippets. The distinction is not stable enough to plan around, and neither term describes a measurement method. Whichever label a vendor uses, the question worth asking is what they observed, how many times, and whether you can see the answer behind the number.',
  },
  {
    id: 'llms-txt',
    title: 'llms.txt',
    category: 'Optimization practice',
    definition:
      "A proposed file at a site's root that lists its documents in a form built for language models to read.",
    details:
      'It follows a published convention: a title, a summary, and sections of links, with each link pointing at a plain-text or markdown version of the page. No major engine has confirmed it uses the file for retrieval or ranking, so adopting it is a bet on convention rather than a measured tactic. Its defensible benefit is immediate and separate from search: an agent handed the file gets clean prose instead of scraped HTML. refd publishes one at /llms.txt.',
  },
];
