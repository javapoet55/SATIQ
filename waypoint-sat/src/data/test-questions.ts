import type {Question} from './questions';
import {readingQuestions} from './test-reading.ts';
export interface TopicQuestion extends Question {topicId:string}
function math(topicId:string,n:number,skill:string,text:string,correctValue:number,options:number[],explanation:string):TopicQuestion{
 const values=[...new Set([correctValue,...options])];for(let v=correctValue+7;values.length<4;v+=7)if(!values.includes(v))values.push(v);values.length=4;const shift=n%4;const choices=values.map((_,i)=>String(values[(i+shift)%4]));
 return{id:`pt-${topicId}-${String(n+1).padStart(2,'0')}`,topicId,section:'math',skill,difficulty:'Practice',text,choices,correct:(4-shift)%4,steps:[['Identify the relationship',explanation],['Check the result',`The correct answer is ${correctValue}. Recheck the units and the original conditions.`]],why:explanation,hint:'Identify the unknown and write the relevant equation or relationship.'};
}
const mathQuestions:TopicQuestion[]=[];
for(let i=0;i<5;i++){
 const a=i+2,x=i+4,b=3*i+5;
 mathQuestions.push(math('algebra',i,'Linear equations',`If ${a}x + ${b} = ${a*x+b}, what is the value of x?`,x,[x+1,x-1,a*x],`Subtract ${b} from each side to get ${a}x = ${a*x}. Divide by ${a}: x = ${x}.`));
 const m=i+2,c=i+3,t=i+5;
 mathQuestions.push(math('algebra',i+5,'Linear functions',`A line has equation y = ${m}x + ${c}. What is y when x = ${t}?`,m*t+c,[m*t,m*(t+c),m*t+c+2],`Substitute x = ${t}: y = ${m}(${t}) + ${c} = ${m*t+c}.`));
 const y=i+2;
 mathQuestions.push(math('algebra',i+10,'Systems of equations',`The system x + y = ${x+y} and x − y = ${x-y} has solution (x, y). What is x?`,x,[y,x+y,x+2],`Add the equations: 2x = ${2*x}, so x = ${x}. Substituting gives y = ${y}.`));
 mathQuestions.push(math('algebra',i+15,'Linear inequalities',`If ${a}x + ${b} ≤ ${a*x+b}, what is the greatest integer value of x?`,x,[x+1,x-1,a*x+b],`Subtract ${b}, then divide by positive ${a}. The inequality becomes x ≤ ${x}; the greatest allowed integer is ${x}.`));
 const rate=i+4,fee=10+i*3,days=i+3,total=fee+rate*days;
 mathQuestions.push(math('algebra',i+20,'Linear models',`A workshop charges a fixed fee of $${fee} plus $${rate} per visit. A student pays $${total}. How many visits did the student make?`,days,[days+1,days-1,rate*days],`Write ${fee} + ${rate}v = ${total}. Subtract the fixed fee and divide: v = (${total} − ${fee}) / ${rate} = ${days}.`));
 const p=i+2,q=i+5;
 mathQuestions.push(math('advanced',i,'Quadratic equations',`What is the larger solution of (x − ${p})(x − ${q}) = 0?`,q,[p,p+q,p*q],`A product is zero when a factor is zero. The roots are ${p} and ${q}, so the larger root is ${q}.`));
 const h=i+2,k=i+4;
 mathQuestions.push(math('advanced',i+5,'Nonlinear functions',`The function f is defined by f(x) = (x − ${h})² + ${k}. What is the minimum value of f(x) for real x?`,k,[h,h+k,k+1],`The squared term is nonnegative and equals zero at x = ${h}. Therefore the minimum is ${k}.`));
 const e=i+2;
 mathQuestions.push(math('advanced',i+10,'Exponents',`For x ≠ 0, the expression (x^${e+3}) / (x^${e}) is equal to x^k. What is k?`,3,[e,e+3,2*e+3],`When dividing powers with the same nonzero base, subtract exponents: (${e+3}) − (${e}) = 3.`));
 const root=i+4;
 mathQuestions.push(math('advanced',i+15,'Radical equations',`If √(x + ${i+2}) = ${root}, what is x?`,root*root-(i+2),[root-(i+2),root*root+(i+2),root*root],`Square both sides: x + ${i+2} = ${root*root}. Subtract ${i+2} to obtain x = ${root*root-(i+2)}. This satisfies the original equation.`));
 const intercept=i+3;
 mathQuestions.push(math('advanced',i+20,'Equivalent expressions',`The expression (x + ${intercept})(x − ${intercept}) is equivalent to x² + c. What is c?`,-intercept*intercept,[intercept*intercept,-intercept,intercept],`Expand the factors: x² − ${intercept}x + ${intercept}x − ${intercept*intercept} = x² − ${intercept*intercept}. Thus c = ${-intercept*intercept}.`));
 const hours=i+3,speed=i+20;
 mathQuestions.push(math('data',i,'Rates',`A cyclist travels at a constant ${speed} kilometers per hour for ${hours} hours. How many kilometers does the cyclist travel?`,speed*hours,[speed+hours,speed*(hours+1),speed*(hours-1)],`Distance = rate × time = ${speed} × ${hours} = ${speed*hours} kilometers.`));
 const price=(i+4)*20,discount=25;
 mathQuestions.push(math('data',i+5,'Percentages',`A jacket originally costs $${price}. It is discounted by ${discount}%. What is the sale price in dollars, before tax?`,price*.75,[price*.25,price+price*.25,price*.5],`The discount is 0.25 × ${price} = ${price*.25}. Subtract it: ${price} − ${price*.25} = ${price*.75}.`));
 const base=i*3+8;
 mathQuestions.push(math('data',i+10,'Statistics',`A data set contains the values ${base}, ${base+2}, ${base+4}, ${base+6}, and ${base+8}. What is its mean?`,base+4,[base+2,base+6,5*base+20],`Add all five values to get ${5*base+20}, then divide by 5: the mean is ${base+4}.`));
 const red=i+2,blue=8-red;
 mathQuestions.push(math('data',i+15,'Probability',`A bag contains ${red} red counters and ${blue} blue counters. One counter is selected at random. What is the probability of selecting a red counter, expressed as a percentage?`,red/8*100,[blue/8*100,red/8*50,red/8*200],`There are 8 equally likely counters. P(red) = ${red}/8 = ${red/8*100}%.`));
 const ratio=i+2,mult=i+3;
 mathQuestions.push(math('data',i+20,'Ratios',`A recipe uses flour and sugar in a ratio of ${ratio}:1 by mass. If the recipe uses ${mult*100} grams of sugar, how many grams of flour are needed?`,ratio*mult*100,[mult*100,ratio*mult*100+100,(ratio+1)*mult*100],`Multiply the sugar mass by the flour-to-sugar ratio: ${ratio} × ${mult*100} = ${ratio*mult*100} grams.`));
 const w=i+4,l=i+8;
 if(i===3)mathQuestions.push(math('geometry',i,'Volume',`A rectangular prism has length ${l}, width ${w}, and height 4. What is its volume in cubic units?`,l*w*4,[l*w,2*(l+w+4),l*w*2],`The volume of a rectangular prism is length × width × height: ${l} × ${w} × 4 = ${l*w*4} cubic units.`));
 else if(i===4)mathQuestions.push(math('geometry',i,'Area',`A triangle has base ${l} centimeters and perpendicular height ${w} centimeters. What is its area in square centimeters?`,l*w/2,[l*w,l+w,2*(l+w)],`The area of a triangle is half its base times perpendicular height: (1/2) × ${l} × ${w} = ${l*w/2} square centimeters.`));
 else mathQuestions.push(math('geometry',i,'Area',`A rectangle has length ${l} centimeters and width ${w} centimeters. What is its area in square centimeters?`,l*w,[2*(l+w),l+w,l*w+w],`The area of a rectangle is length × width: ${l} × ${w} = ${l*w} square centimeters.`));
 const angle=35+i*5;
 mathQuestions.push(math('geometry',i+5,'Lines and angles',`Two angles form a straight line. One measures ${angle}°. How many degrees does the other angle measure?`,180-angle,[90-angle,angle,180+angle],`Angles forming a straight line sum to 180°. The missing angle is 180 − ${angle} = ${180-angle}°.`));
 const scale=i+1;
 mathQuestions.push(math('geometry',i+10,'Right triangles',`A right triangle has legs of length ${3*scale} and ${4*scale}. What is its hypotenuse?`,5*scale,[7*scale,25*scale,4*scale],`Use a² + b² = c²: c = √(${9*scale*scale} + ${16*scale*scale}) = √${25*scale*scale} = ${5*scale}.`));
 const radius=i+2;
 mathQuestions.push(math('geometry',i+15,'Circles',`A circle has radius ${radius}. Its area is kπ square units. What is k?`,radius*radius,[2*radius,radius,radius*radius+1],`A = πr² = π(${radius})² = ${radius*radius}π, so k = ${radius*radius}.`));
 mathQuestions.push(math('geometry',i+20,'Trigonometry',`In a right triangle, angle θ has opposite side ${3*scale} and hypotenuse ${5*scale}. What is sin θ?`,.6,[.8,.75,1.25],`For an acute angle in a right triangle, sin θ = opposite / hypotenuse = ${3*scale}/${5*scale} = 3/5 = 0.6.`));
}
export const topicQuestions:TopicQuestion[]=[...mathQuestions,...readingQuestions];
