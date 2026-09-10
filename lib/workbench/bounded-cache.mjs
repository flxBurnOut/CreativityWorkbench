// Limits retained data by both weight and count. Eviction never deletes files.
export function boundedCache(maxEntries,maxWeight=Infinity) {
  const values=new Map();let weight=0;
  const remove=key=>{const old=values.get(key);if(old){weight-=old.weight;values.delete(key);}};
  return {
    get(key){const item=values.get(key);if(!item)return;values.delete(key);values.set(key,item);return item.value;},
    has:key=>values.has(key),keys:()=>values.keys(),delete:remove,
    set(key,value,cost=1){remove(key);if(cost>maxWeight)return;values.set(key,{value,weight:cost});weight+=cost;while(values.size>maxEntries||weight>maxWeight)remove(values.keys().next().value);},
    stats:()=>({entries:values.size,weight,maxEntries,maxWeight}),
  };
}
