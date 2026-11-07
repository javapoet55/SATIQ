import type {Cause} from '../companion-types';
export const tutorContent: Record<string, {hints: string[]; explain: string; example: string; insight: string; equation: string; suggested: Cause}> = {
  'wp-math-001': {
    hints:['The total includes two parts: a one-time fee and a cost for each day. Which part changes with the number of days?', 'Remove the one-time $18 fee from the $60 total. How much is left for the daily charges?', 'There is $42 left for daily charges. Each day costs $7. What operation gives the number of days?'],
    explain:'Start by subtracting the fixed fee from the total: 60 − 18 = 42. This leaves the part paid per day. Can you turn that into an equation?',
    example:'I knew I needed to remove the fee. I wrote 60 − 18 = 28, then divided by 7 and got 4.',
    insight:'In the example reflection, subtracting the fixed fee is a useful first step. The subtraction is the first operation that goes off track.', equation:'60 − 18 = 42, not 28', suggested:'calculation',
  },
  'wp-rw-001': {
    hints:['Compare the two ideas: the station was restored, then it became a market. Is that a contrast or a consequence?', 'The restoration made the market possible. Look for a transition that signals a result.', 'Eliminate the contrast words first. Then compare an example transition with a result transition.'],
    explain:'A semicolon joins the ideas. The transition after it should explain how the market opening relates to the restoration. What relationship do you see?',
    example:'I chose nevertheless because I thought any transition could connect the two sentences.',
    insight:'In this example, the missing step is identifying the relationship before choosing a transition. Restoration makes the market possible; the ideas express cause and effect.',equation:'Restoration → new use',suggested:'concept',
  },
  'wp-math-002': {
    hints:['A 25% discount removes one quarter of the original price. What is one quarter of $8?', 'Find 25% of $8 first. That amount is the discount, not the final price.', 'The discount is $2. Subtract that from the original $8 price.'],
    explain:'Multiply $8 by 0.25 to find the discount. The question asks what remains after subtracting it from the original price.',
    example:'I calculated 25% of $8 as $2, then chose $2 as the discounted price.',
    insight:'In this example, the discount amount is calculated correctly. The missing operation is subtracting the discount from the original price.',equation:'Final price = original price − discount',suggested:'reading',
  },
  'wp-rw-002': {
    hints:['Look at the explanation after the colon. What happened to the plants after the drought?', 'The phrase “quickly recovered” explains the description of the wetland.', 'Compare each answer with the idea of recovering after a difficult event.'],
    explain:'The words after the colon explain “resilient.” Use what the plants did after the drought to test each possible meaning.',
    example:'I chose unusually colorful because I pictured plants, without using the words after the colon.',
    insight:'In this example, the answer comes from an association with plants rather than evidence in the sentence. The phrase “quickly recovered” gives the useful clue.',equation:'Use the sentence’s evidence, not an association',suggested:'reading',
  },
};
export const causeOptions: {id: Cause; title: string; description: string}[] = [
  {id:'calculation',title:'Calculation slip',description:'I had the approach, but made an arithmetic error.'},
  {id:'concept',title:'Concept gap',description:'I wasn’t sure how to set up the problem or identify the relationship.'},
  {id:'reading',title:'Question misunderstanding',description:'I misread what the question was asking.'},
  {id:'unsure',title:'Something else / not sure',description:'I’d like to explore another explanation.'},
];
export function strategy(cause: Cause, section: 'math' | 'rw') {
  return {
    calculation:{title:'Build in a quick check.',text:section === 'math' ? 'Estimate each calculation, then substitute your final answer into the original situation.' : 'Read the sentence once more with your choice and compare the relationship with the evidence.'},
    concept:{title:section === 'math' ? 'Separate the parts.' : 'Name the relationship.',text:section === 'math' ? 'Write the fixed fee, rate, or discount as separate parts before solving.' : 'State how the ideas connect, or what the surrounding words tell you, before comparing choices.'},
    reading:{title:'Name what you need to find.',text:section === 'math' ? 'Underline what the question asks for. Define the unknown and include its unit.' : 'Underline the relevant words and restate the question in your own words before choosing.'},
    unsure:{title:'Talk through the first step.',text:'Open the guided tutor and ask for a small hint to identify where you feel stuck.'},
  }[cause];
}
