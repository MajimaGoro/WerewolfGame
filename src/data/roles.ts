import type { RoleDefinition, RoleId } from '../types';

export const ROLE_DEFINITIONS: Record<RoleId, RoleDefinition> = {
  villager: {
    id: 'villager',
    name: '村民',
    camp: 'villager',
    description: '白天参与讨论和投票，没有夜间技能。',
    priority: 99,
  },
  wolf: {
    id: 'wolf',
    name: '狼人',
    camp: 'wolf',
    description: '夜晚选择一名玩家作为袭击目标，多名狼人身份会按票数结算。',
    priority: 40,
    speechPrompt: '拥有狼人身份的玩家请悄悄接过手机，选择今晚的袭击目标。',
    ability: {
      id: 'wolf-kill',
      prompt: '请选择今晚想要袭击的玩家。',
      effectType: 'kill',
      targetRule: 'alive-other',
    },
  },
  seer: {
    id: 'seer',
    name: '预言家',
    camp: 'villager',
    description: '夜晚查验一名玩家，获知其当前阵营。',
    priority: 20,
    speechPrompt: '拥有预言家身份的玩家请接过手机，查验一名玩家。',
    ability: {
      id: 'seer-inspect',
      prompt: '请选择一名玩家进行查验。',
      effectType: 'inspect',
      targetRule: 'alive-other',
    },
  },
  guard: {
    id: 'guard',
    name: '守卫',
    camp: 'villager',
    description: '夜晚守护一名玩家，阻挡本夜的狼人袭击。',
    priority: 10,
    speechPrompt: '拥有守卫身份的玩家请接过手机，选择一名玩家守护。',
    ability: {
      id: 'guard-protect',
      prompt: '请选择今晚要守护的玩家。',
      effectType: 'protect',
      targetRule: 'alive-other',
    },
  },
  witch: {
    id: 'witch',
    name: '女巫',
    camp: 'villager',
    description:
      '夜晚可使用一次解药救人，或使用一次毒药毒杀一名玩家。当前版本每晚二选一。',
    priority: 50,
    speechPrompt: '拥有女巫身份的玩家请接过手机，决定是否使用药剂。',
    ability: {
      id: 'witch-action',
      prompt: '你可以选择救人、毒人或跳过本夜。',
      effectType: 'save',
      targetRule: 'none',
    },
  },
};
