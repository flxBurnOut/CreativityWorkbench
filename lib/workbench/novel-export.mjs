// Shared by browser downloads and MCP. Preserve stored drafts and interior text.
export function formatNovel(novel,format='md') {
  const title=novel.title.trim();let body=novel.text;
  const first=/^(?:[ \t]*\r?\n)*([^\r\n]*)(?:\r?\n|$)/.exec(body.replace(/^\uFEFF/,''));
  if(first&&title) {
    const heading=first[1].trim().replace(/^#{1,6}\s+/,'').replace(/\s+#+$/,'').replace(/^\*\*(.*)\*\*$/,'$1');
    if(heading===title)body=body.replace(/^\uFEFF/,'').slice(first[0].length).replace(/^(?:[ \t]*\r?\n)+/,'');
  }
  const output=(title?(format==='md'?'# ':'')+title+'\n\n':'')+body;
  return output.endsWith('\n')?output:output+'\n';
}
