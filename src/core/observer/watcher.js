/* @flow */

import config from '../config'
import Dep, { pushTarget, popTarget } from './dep'
import { queueWatcher } from './scheduler'
import {
    warn,
    remove,
    isObject,
    parsePath,
    _Set as Set
} from '../util/index'

let uid = 0

/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 */
export default class Watcher {
    vm: Component;
    expression: string;
    cb: Function;
    id: number;
    deep: boolean;
    user: boolean;
    lazy: boolean;
    sync: boolean;
    dirty: boolean;
    active: boolean;
    deps: Array < Dep > ;
    newDeps: Array < Dep > ;
    depIds: Set;
    newDepIds: Set;
    getter: Function;
    value: any;

    constructor(
        vm: Component,
        expOrFn: string | Function,
        cb: Function,
        options ? : Object
    ) {
        console.log('Wather-', expOrFn);
        this.vm = vm
        vm._watchers.push(this)
            // options
        if (options) {
            this.deep = !!options.deep
            this.user = !!options.user
            this.lazy = !!options.lazy
            this.sync = !!options.sync
        } else {
            this.deep = this.user = this.lazy = this.sync = false
        }
        this.cb = cb
        this.id = ++uid // uid for batching
        this.active = true
        this.dirty = this.lazy // for lazy watchers
        this.deps = []
        this.newDeps = []
        this.depIds = new Set()
        this.newDepIds = new Set()
        this.expression = process.env.NODE_ENV !== 'production' ?
            expOrFn.toString() :
            ''
            // parse expression for getter
        if (typeof expOrFn === 'function') {
            this.getter = expOrFn
        } else {
            this.getter = parsePath(expOrFn)
            if (!this.getter) {
                this.getter = function() {}
                process.env.NODE_ENV !== 'production' && warn(
                    `Failed watching path: "${expOrFn}" ` +
                    'Watcher only accepts simple dot-delimited paths. ' +
                    'For full control, use a function instead.',
                    vm
                )
            }
        }
        this.value = this.lazy ?
            undefined :
            this.get()
    }

    /**
     * Evaluate the getter, and re-collect dependencies.
     */
    get() {
        pushTarget(this)
            // 取出this.vm[expOrFn]或执行expOrFn
            //
            // ⚠️如果该watcher是vm._watcher，那么getter是一个很复杂的更新渲染函数，
            // 只要在其中被访问的数据有__ob__属性，就会将其依赖添加到vm._watcher.deps
            // 所以你会发现vm.data中的数据在改变时会更新页面，就是这里搞的鬼
        const value = this.getter.call(this.vm, this.vm)
            // "touch" every property so they are all tracked as
            // dependencies for deep watching
            // 依次取属性值，这样每个属性都会在getter中调defineReactive，
            // defineReactive这里面有对依赖的处理
        if (this.deep) {
            traverse(value)
        }
        popTarget()
        this.cleanupDeps()
        return value
    }

    /**
     * Add a dependency to this directive.
     */
    addDep(dep: Dep) {
        const id = dep.id
        if (!this.newDepIds.has(id)) {
            this.newDepIds.add(id)
            this.newDeps.push(dep)
            if (!this.depIds.has(id)) {
                dep.addSub(this)
            }
        }
    }

    /**
     * Clean up for dependency collection.
     */
    cleanupDeps() {
        let i = this.deps.length
        while (i--) {
            const dep = this.deps[i]
            if (!this.newDepIds.has(dep.id)) {
                dep.removeSub(this)
            }
        }
        let tmp = this.depIds
        this.depIds = this.newDepIds
        this.newDepIds = tmp
        this.newDepIds.clear()
        tmp = this.deps
        this.deps = this.newDeps
        this.newDeps = tmp
        this.newDeps.length = 0
    }

    /**
     * Subscriber interface.
     * Will be called when a dependency changes.
     */
    update() {
        /* istanbul ignore else */
        if (this.lazy) {
            this.dirty = true
        } else if (this.sync) {
            this.run()
        } else {
            queueWatcher(this)
        }
    }

    /**
     * Scheduler job interface.
     * Will be called by the scheduler.
     */
    run() {
        if (this.active) {
            const value = this.get()
            if (
                value !== this.value ||
                // Deep watchers and watchers on Object/Arrays should fire even
                // when the value is the same, because the value may
                // have mutated.
                // 深层watcher和对象（或数组）的watcher即使value相同也要触发
                // 因为value可能已经变了。
                isObject(value) ||
                this.deep
            ) {
                // set new value
                const oldValue = this.value
                this.value = value
                    //
                    // 执行callback
                    //
                    // 第一种情况只是多了异常处理，第二种情况是裸执行cb
                if (this.user) {
                    try {
                        this.cb.call(this.vm, value, oldValue)
                    } catch (e) {
                        /* istanbul ignore else */
                        if (config.errorHandler) {
                            config.errorHandler.call(null, e, this.vm)
                        } else {
                            process.env.NODE_ENV !== 'production' && warn(
                                `Error in watcher "${this.expression}"`,
                                this.vm
                            )
                            throw e
                        }
                    }
                } else {
                    this.cb.call(this.vm, value, oldValue)
                }
            }
        }
    }

    /**
     * Evaluate the value of the watcher.
     * This only gets called for lazy watchers.
     */
    evaluate() {
        this.value = this.get()
        this.dirty = false
    }

    /**
     * Depend on all deps collected by this watcher.
     */
    depend() {
        let i = this.deps.length
        while (i--) {
            this.deps[i].depend()
        }
    }

    /**
     * Remove self from all dependencies' subscriber list.
     */
    teardown() {
        if (this.active) {
            // remove self from vm's watcher list
            // this is a somewhat expensive operation so we skip it
            // if the vm is being destroyed.
            if (!this.vm._isBeingDestroyed) {
                remove(this.vm._watchers, this)
            }
            let i = this.deps.length
            while (i--) {
                this.deps[i].removeSub(this)
            }
            this.active = false
        }
    }
}

/**
 * Recursively traverse an object to evoke all converted
 * getters, so that every nested property inside the object
 * is collected as a "deep" dependency.
 */
const seenObjects = new Set()

function traverse(val: any) {
    seenObjects.clear()
    _traverse(val, seenObjects)
}

function _traverse(val: any, seen: Set) {
    let i, keys
    const isA = Array.isArray(val)
    if ((!isA && !isObject(val)) || !Object.isExtensible(val)) {
        return
    }
    if (val.__ob__) {
        const depId = val.__ob__.dep.id
            // seen保存的是被观察(observer)的数据的depid
        if (seen.has(depId)) {
            return
        }
        seen.add(depId)
    }
    if (isA) {
        i = val.length
        while (i--) _traverse(val[i], seen)
    } else {
        keys = Object.keys(val)
        i = keys.length
        while (i--) _traverse(val[keys[i]], seen)
    }
}