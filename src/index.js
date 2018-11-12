import React from 'react';

function reducerInAction(state, action) {
  if (typeof action.reducer === 'function') {
    return action.reducer(state);
  }
  return state;
}

const subscribeCache = {};
let subscribeNum = 0;
function subscribe(fn) {
  if (typeof fn !== 'function') {
    throw new Error('react-hooks-redux: subscribe params need a function');
  }
  subscribeNum++;
  subscribeCache[subscribeNum] = fn;
  function unSubscribe() {
    delete subscribeCache[subscribeNum];
  }
  return unSubscribe;
}

function runSubscribes(action, state) {
  for (const k in subscribeCache) {
    subscribeCache[k](state);
  }
}

const defalutOptions = {
  isDev: false,
  reducer: reducerInAction,
  initialState: {},
  middleware: [middlewareLog],
  autoSave: { item: undefined, keys: [] },
};

export default function createStore(options = defalutOptions) {
  const { isDev, reducer, initialState, middleware, autoSave } = {
    ...defalutOptions,
    ...options,
  };
  const AppContext = React.createContext();
  const store = {
    isDev,
    _state: initialState,
    useContext: function() {
      return React.useContext(AppContext);
    },
    subscribe,
    dispatch: undefined,
    getState: function() {
      return store._state;
    },
    onload: [],
    initialState,
  };
  let isCheckedMiddleware = false;
  const middlewareReducer = function(lastState, action) {
    let nextState = reducer(lastState, action);
    if (!isCheckedMiddleware) {
      if (Object.prototype.toString.call(middleware) !== '[object Array]') {
        throw new Error("react-hooks-redux: middleware isn't Array");
      }
      isCheckedMiddleware = true;
    }
    for (let i = 0; i < middleware.length; i++) {
      const newState = middleware[i](store, lastState, nextState, action);
      if (newState) {
        nextState = newState;
      }
    }
    store._state = nextState;
    runSubscribes(action, nextState);
    return nextState;
  };
  if (autoSave && autoSave.item) {
    autoSaveLocalStorage(store, autoSave.item, autoSave.keys);
  }
  function Provider(props) {
    const [state, dispatch] = React.useReducer(middlewareReducer, initialState);
    if (!store.dispatch) {
      store.dispatch = async function(action) {
        if (typeof action === 'function') {
          await action(dispatch, store._state);
        } else {
          dispatch(action);
        }
      };
    }
    React.useEffect(() => {
      for (let i = 0; i < store.onload.length; i++) {
        store.onload[i]();
      }
    }, []);
    return <AppContext.Provider {...props} value={state} />;
  }
  return { Provider, store };
}

// 用于本地存储的方法
export const storage = {
  localName: 'defaultIOKey',
  save: (v, theKey = storage.localName) => {
    const theType = Object.prototype.toString.call(v);
    if (theType === '[object Object]') {
      localStorage.setItem(theKey, JSON.stringify(v));
    } else if (theType === '[object String]') {
      localStorage.setItem(theKey, v);
    } else {
      console.warn('Warn: storage.save() param is no a Object');
    }
  },
  load: (theKey = storage.localName) => {
    try {
      const data = localStorage.getItem(theKey);
      if (data) {
        if (typeof data === 'string') {
          return JSON.parse(data);
        }
        return data;
      }
    } catch (err) {
      console.warn('load last localSate error');
    }
  },
  clear: (theKey = storage.localName) => {
    localStorage.setItem(theKey, {});
  },
};

// 这里做自动保存的监听
export function autoSaveLocalStorage(store, localName, needSaveKeys) {
  if (localName) {
    storage.localName = localName;
  }
  if (Object.prototype.toString.call(needSaveKeys) !== '[object Array]') {
    // eslint-disable-next-line
    console.warn('autoSaveStorageKeys: params is no a Array');
  }
  //首次加载读取历史数据
  const lastLocalData = storage.load(storage.localName);
  if (Object.prototype.toString.call(lastLocalData) === '[object Object]') {
    store.onload.push(() => {
      store.dispatch({
        type: 'localStorageLoad: IO',
        reducer: state => {
          // 如果是immutable 使用toJS
          if (state && state.toJS) {
            const data = {
              ...state.toJS(),
              ...lastLocalData,
            };
            for (const key in data) {
              state = state.set(key, data[key]);
            }
            return state;
          }
          // 非immutable直接合并历史数据
          return {
            ...state,
            ...lastLocalData,
          };
        },
      });
    });
  }
  // 只有needSaveKeys的修改会激发IO, lastDats保存之前的记录
  const lastDatas = {};
  needSaveKeys.forEach(v => {
    lastDatas[v] = undefined;
  });
  store.subscribe(() => {
    const state = store.getState();
    if (state && state.toJS) {
      //immutable 类型
      const nowDatas = {};
      let isNeedSave = false;
      needSaveKeys.forEach(v => {
        // 监听数据和 Immutable 配合做低开销校验
        if (Object.prototype.toString.call(v) === '[object Array]') {
          nowDatas[v] = state.getIn(v);
        } else {
          nowDatas[v] = state.get(v);
        }
        if (lastDatas[v] !== nowDatas[v]) {
          isNeedSave = true;
        }
        lastDatas[v] = nowDatas[v];
      });
      if (isNeedSave) {
        storage.save(nowDatas);
      }
    } else {
      // 非immutable做浅比较判断是否需要保存
      console.log('kk', state);
      const nowDatas = {};
      let isNeedSave = true;
      needSaveKeys.forEach(v => {
        nowDatas[v] = state[v];
        if (lastDatas[v] !== nowDatas[v]) {
          isNeedSave = true;
        }
        lastDatas[v] = nowDatas[v];
      });
      if (isNeedSave) {
        storage.save(nowDatas);
        // needSaveKeys.forEach(v => {
        //   lastDatas[v] = nowDatas[v];
        // });
      }
    }
  });
}

export function middlewareLog(store, lastState, nextState, action) {
  if (store.isDev) {
    if (lastState && typeof lastState.toJS === 'function') {
      middlewareImmutableLog(store, lastState, nextState, action);
    } else {
      console.log(
        `%c|------- redux: ${action.type} -------|`,
        `background: rgb(70, 70, 70); color: rgb(240, 235, 200); width:100%;`,
      );
      console.log('|--last:', lastState);
      console.log('|--next:', nextState);
    }
  }
}

export function middlewareImmutableLog(store, lastState, nextState, action) {
  if (store.isDev) {
    let data;
    if (nextState === undefined || !nextState.toJS) {
      data = [lastState, nextState];
    } else {
      data = getImmerForKeys(lastState, nextState);
    }
    console.log(
      `%c|------- redux: ${action.type} -------|`,
      `background: rgb(70, 70, 70); color: rgb(240, 235, 200); width:100%;`,
    );
    console.log('|--diff:', data[0]);
    console.log('|--merge:', data[1]);
  }
}

function getImmerForKeys(last, next) {
  const endDiff = {};
  const endNext = {};
  // eslint-disable-next-line
  last.map((d1, k) => {
    const d2 = next.get(k);
    if (d1 !== d2) {
      if (Object.prototype.toString.call(d1) === '[object Object]') {
        endDiff[k] = {};
        for (const k2 in d2) {
          const sub1 = last.getIn([k, k2]);
          const sub2 = next.getIn([k, k2]);
          if (sub1 !== sub2) {
            endDiff[k][k2] = sub2;
          }
        }
      } else {
        endDiff[k] = d2;
      }
    }
    endNext[k] = d2;
  });
  return [endDiff, endNext];
}
