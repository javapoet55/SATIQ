export interface TestTopic {id:string;section:'math'|'rw';name:string;icon:string;description:string;skills:string[];minutes:number}
export const testTopics:TestTopic[]=[
 {id:'algebra',section:'math',name:'Algebra',icon:'ƒ',description:'Build confidence with equations, relationships, and unknowns.',skills:['Linear equations','Linear functions','Systems of equations','Linear inequalities'],minutes:40},
 {id:'advanced',section:'math',name:'Advanced Math',icon:'x²',description:'Find the structure in expressions, functions, and nonlinear equations.',skills:['Equivalent expressions','Quadratic equations','Nonlinear functions','Exponents and radicals'],minutes:40},
 {id:'data',section:'math',name:'Problem-Solving & Data Analysis',icon:'▥',description:'Make sense of numbers, data, proportions, and uncertainty.',skills:['Ratios and rates','Percentages','Statistics','Probability and data'],minutes:40},
 {id:'geometry',section:'math',name:'Geometry & Trigonometry',icon:'△',description:'Connect shapes, measurements, angles, and right triangles.',skills:['Area and volume','Lines and angles','Right triangles','Circles and trigonometry'],minutes:40},
 {id:'information',section:'rw',name:'Information & Ideas',icon:'≡',description:'Read closely, connect evidence, and draw supported conclusions.',skills:['Central ideas and details','Inferences','Textual evidence','Quantitative evidence'],minutes:30},
 {id:'craft',section:'rw',name:'Craft & Structure',icon:'Aa',description:'Explore word meanings, author choices, and connections between texts.',skills:['Words in context','Text structure and purpose','Cross-text connections'],minutes:30},
 {id:'expression',section:'rw',name:'Expression of Ideas',icon:'↔',description:'Choose clear transitions and shape information around a goal.',skills:['Transitions','Rhetorical synthesis'],minutes:30},
 {id:'conventions',section:'rw',name:'Standard English Conventions',icon:'¶',description:'Make sentences precise, complete, and grammatically consistent.',skills:['Sentence boundaries','Punctuation','Subject–verb agreement','Form, structure, and sense'],minutes:30},
];
export const topicById=(id:string)=>testTopics.find(t=>t.id===id);
