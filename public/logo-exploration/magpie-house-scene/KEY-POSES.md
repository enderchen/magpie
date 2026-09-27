# 四个关键动作候选

2026-09-21，基于已确认 house-scene-v2.png，使用内置 imagegen 生成 key-poses-v1.png。未修改首页。

- 接件：客户持纸上缘，喜鹊伸翼接纸下缘，另一翼收在身侧。
- 上楼：朝右上方行进，两脚分别落在不同台阶，尾羽朝后，背包贴身。
- 递链接：一翼递出链接卡片，另一翼收拢；住户走至门口接件。
- 返回：面朝左下方，两脚交替下楼，空翼返回。

图像检查：四格均能辨认两翼两脚，方向符合楼梯坡向，第三格已使用链接符号而非 HTML。当前是姿态候选，并非拆层动画素材；连续步态、远侧翼的遮挡、背包固定肩侧仍需在动画 rig 中统一，不能直接镜像替代转身。栏杆最终需独立前景层。HTML 变网页的过渡需另外编排，不能从四格中省略该产品环节。

## 制作顺序

姿势确认后：制作背景净版、前景栏杆、客户与住户、喜鹊关节图层；先完成交件到上楼至首间房的小段网页动画，再扩展三个房间与回程循环。全部在独立预览实现，保留原首页。

## 生成提示词

Create an animation key-pose approval board, 2x2 panels, landscape high resolution, clean white gutters. Use attached approved house scene as strict CHARACTER AND ENVIRONMENT reference: same round lime-green magpie white belly and wing patches black outlines green courier cap long tail light blue crossbody bag with chain symbol, same bespectacled navy-shirt male customer, same cream/light blue house and sparse black railing. Four coherent CLOSE-UP story moments, no tiny whole houses. Exactly ONE magpie per panel, EXACTLY TWO WINGS and TWO bird feet with clear shoulder attachment, wings are feathered never human hands, bag strap not limb, long tail originates rump. Maintain identical proportions and cap/bag details throughout. Panel upper left labeled '01 接件': customer facing right hands white HTML paper to magpie facing left at ground floor; one wing reaches paper lower edge, other folds by torso, both feet planted. Panel upper right labeled '02 上楼': magpie clearly side profile facing RIGHT ascending staircase that rises from LOWER LEFT to UPPER RIGHT, one foot on upper tread, other foot on lower tread, body leans forward slightly, near wing holds bag stable and far wing slightly back for balance, tail trailing LEFT above steps, no floating feet, no third wing. Stairs and sparse railing are physical same as reference. Panel lower left labeled '03 递链接': magpie stands on upstairs walkway facing RIGHT, gives a small WHITE card with black CHAIN LINK symbol to a standing room resident on right wearing coral shirt, hand meets wingtip at card, bird other wing folded clearly visible, feet grounded, tail left; doorway behind resident, foreground railing at bottom below the handoff so nothing obscures paper. This is digital-link metaphor, not HTML file at this stage. Panel lower right labeled '04 返回': magpie side profile facing LEFT DESCENDING SAME staircase sloping lower-left to upper-right, one foot reaches a lower tread to LEFT, other remains upper tread to RIGHT, tail trailing RIGHT, wings relaxed one balancing, bag same side of body as anatomical reference, NO paper in wing, satisfied gentle expression; no human in this panel. Essential directional logic: upper-right ascending right/up, lower-right descending left/down. Keep all feet contacting appropriate treads. No extra props no bonus panels no explanatory paragraphs. Cheerful restrained flat cartoon near-black thick lines white background light blue environment lime main character, not 3D not painterly. Labels only the four Chinese labels above plus HTML and chain icon. Do not mirror text.
